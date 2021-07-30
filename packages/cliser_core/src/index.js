import axios from "axios";

export const EMPTY_OBJECT = {};
export const EMPTY_ARRAY = [];
export const NOOP = () => {};

export function createCollection(name, storage, options = EMPTY_OBJECT) {
  let defaultValue = EMPTY_ARRAY;

  if (typeof storage !== "string") {
    defaultValue = storage || EMPTY_ARRAY;
    storage = null;
  }

  const createAction = (action, args) => ({
    $$type: "action",
    action,
    collection,
    args,
  });
  const createMethod =
    (action) =>
    (...args) =>
      createAction(action, args);

  const collection = {
    name,
    options,
    storage,
    items: defaultValue,
    findOne: createMethod("findOne"),
    findMany: createMethod("findMany"),
    updateOne: createMethod("updateOne"),
    updateMany: createMethod("updateMany"),
    insertOne: createMethod("insertOne"),
    insertMany: createMethod("insertMany"),
    count: createMethod("count"),
    removeOne: createMethod("removeOne"),
    removeMany: createMethod("removeMany"),
    call: (action, ...args) => createAction(action, args),
  };

  return collection;
}

export function createMemoryStorage() {
  function find(items, filter, orderBy) {
    if (filter) items = items.filter(filter);
    if (orderBy)
      items = (filter ? items : items.slice(0)).sort((a, b) => {
        const av = orderBy(a);
        const bv = orderBy(b);
        return av > bv ? 1 : av < bv ? -1 : 0;
      });
    return items;
  }

  const executors = {
    findOne: createExecutor((items, filter, map, orderBy) => {
      items = find(items, filter, orderBy);
      return {
        result: items.length ? (map ? map(items[0], 0) : items[0]) : undefined,
      };
    }),
    findMany: createExecutor((items, filter, map, orderBy) => {
      items = find(items, filter, orderBy);
      return {
        result: map ? items.map(map) : items,
      };
    }),
    insertOne: createExecutor((items, newItem) => {
      return {
        items: items.concat([newItem]),
        result: 1,
      };
    }),
    insertMany: createExecutor((items, newItems) => {
      if (!newItems.length)
        return {
          items,
          result: 0,
        };
      return {
        items: items.concat(newItems),
        result: newItems.length,
      };
    }),
    updateOne: createExecutor((items, filter, update, upsert) => {
      let updated = 0;
      const updatedItems = items.map((item, index) => {
        if (!updated && filter(item, index)) {
          updated++;
          return typeof update === "function" ? update(item, index) : update;
        }
        return item;
      });

      if (updated) {
        return {
          items: updatedItems,
          result: updated,
        };
      }

      if (upsert) {
        return {
          items: items.concat([
            typeof update === "function" ? update() : update,
          ]),
          result: 1,
        };
      }

      return { result: 0 };
    }),
    updateMany: createExecutor((items, filter, update, upsert) => {
      let updated = 0;
      const updatedItems = items.map((item, index) => {
        if (filter(item, index)) {
          updated++;
          return typeof update === "function" ? update(item, index) : update;
        }
        return item;
      });

      if (updated) {
        return {
          items: updatedItems,
          result: updated,
        };
      }

      if (upsert) {
        return {
          items: items.concat([
            typeof update === "function" ? update() : update,
          ]),
          result: 1,
        };
      }

      return { result: 0 };
    }),
    removeOne: createExecutor((items, filter, map, orderBy) => {}),
    removeMany: createExecutor((items, filter, map, orderBy) => {}),
    count: createExecutor((items, filter) => {
      return {
        result: find(items, filter).length,
      };
    }),
  };

  function createExecutor(body) {
    return function (collection, action, args, onSuccess = NOOP, onError) {
      const prevItems = collection.items;

      try {
        const { items = prevItems, result } = body(prevItems, ...args);
        if (items) {
          collection.items = items;
        }
        return onSuccess({
          action,
          collection,
          updated: prevItems !== collection.items,
          result,
        });
      } catch (error) {
        if (!onError) throw error;
        return onError({ error });
      }
    };
  }

  function dispatch(collection, action, args, callback) {
    const executor = executors[action];
    if (!executor) throw new Error(`Not support action ${action}`);
    return executor(collection, action, args, callback);
  }

  return { dispatch };
}

export function createCancellationToken(parent) {
  let cancelled = false;

  return {
    get cancelled() {
      return cancelled || (parent && parent.cancelled);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
    },
  };
}

export function createEmitter() {
  const events = new Map();

  function getHandlers(event) {
    let handlers = events.get(event);
    if (!handlers) {
      handlers = [];
      events.set(event, handlers);
    }
    return handlers;
  }

  function on(event, handler) {
    const handlers = getHandlers(event);
    handlers.push(handler);
    let active = true;
    return function () {
      if (!active) return;
      active = false;
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    };
  }

  function emit(event, payload) {
    const handlers = getHandlers(event);
    handlers.slice(0).forEach((handler) => handler(payload));
  }

  return {
    emit,
    on,
  };
}

export function createStore({ connections = EMPTY_OBJECT } = EMPTY_OBJECT) {
  const connectionMap = {};
  const emitter = createEmitter();
  const memoryStorage = createMemoryStorage();

  Object.keys(connections).forEach((key) => {
    const connection = connections[key];
    if (typeof connection === "string") {
      connectionMap[key] = createHttpConnection(connection);
    } else {
      connectionMap[key] = connection;
      // listen collection change event from server
      if (typeof connection.subscribe === "function") {
        connection.subscribe(notifyChange);
      }
    }
  });

  function notifyChange(e) {
    emitter.emit("*", e);
    if (e.collection) {
      emitter.emit(`collection:${e.collection.name}`, e);
    }
  }

  function dispatch(action, ...args) {
    // broadcasting signal
    if (typeof action === "string") {
      return emitter.emit(action, args[0]);
    }

    // executing an action
    if (typeof action === "function") {
      const [
        payload,
        options = EMPTY_OBJECT,
        onSuccess = NOOP,
        onError = NOOP,
      ] = args;
      const ct = createCancellationToken(options.ct);
      process(
        action(payload),
        { ...options, ct, handleAction, dispatch, subscribe },
        (result) => {
          ct.result = result;
          onSuccess(result);
        },
        (error) => {
          if (onError === NOOP) throw error;
          onError(error);
        }
      );
      return ct;
    }

    if (!action || typeof action !== "object")
      throw new Error("Invalid dispatching action");

    // sending action to connection
    const [onSuccess, onError] = args;
    const collection = action.collection;
    if (type === "change") {
      const connection = connectionMap[collection.storage];
      if (!connection)
        throw new Error(`No connection for storage ${collection.storage}`);
      return connection.dispatch(action, EMPTY_OBJECT, onSuccess, onError);
    }
  }

  function subscribe() {
    if (arguments.length > 1) return emitter.on(arguments[0], arguments[1]);
    return emitter.on("*", arguments[0]);
  }

  function handleAction(actionInfo, options, onSuccess = NOOP, onError = NOOP) {
    const { action, collection, args } = actionInfo;
    if (typeof options.addDependency === "function") {
      options.addDependency("collection", collection);
    }
    // memory storage
    if (!collection.storage) {
      return memoryStorage.dispatch(
        collection,
        action,
        args,
        (e) => {
          if (e.updated) {
            notifyChange({ ...e, type: "change" });
          }
          onSuccess(e.result);
        },
        (e) => onError(e.error)
      );
    }
    const connection =
      connectionMap[collection.storage] || connectionMap.default;
    if (!connection)
      throw new Error(`No connection for storage ${collection.storage}`);
    return connection.dispatch(actionInfo, options, onSuccess, onError);
  }

  return {
    dispatch,
    subscribe,
  };
}

export function createHttpConnection(url) {
  async function dispatch(
    { collection, ...actionInfo },
    options,
    onSuccess = NOOP,
    onError = NOOP
  ) {
    const ct = options.ct || EMPTY_OBJECT;
    return axios
      .post(url, {
        ...actionInfo,
        collection: {
          name: collection.name,
          storage: collection.storage,
        },
      })
      .then(
        ({ result, updated }) => {
          if (ct.cancelled) return;

          onSuccess(result);

          if (updated) {
            notifyChange({
              collection,
              action: actionInfo.action,
              args: actionInfo.args,
              type: "change",
            });
          }
        },
        onError === NOOP ? null : (error) => !ct.cancelled && onError(error)
      );
  }

  return {
    dispatch,
  };
}

function process(obj, options, onSuccess = NOOP, onError = NOOP) {
  const ct = options.ct || EMPTY_OBJECT;
  if (typeof obj === "function") obj = obj();

  // is signal
  if (typeof obj === "string") {
    const unsubscribe = options.subscribe(obj, (payload) => {
      unsubscribe();
      if (ct.cancelled) return;
      onSuccess(payload);
    });
    return;
  }

  if (obj && typeof obj === "object") {
    // is promise
    if (typeof obj.then === "function") {
      return obj.then(
        (result) => !ct.cancelled && onSuccess(result),
        onError === NOOP ? null : (error) => !ct.cancelled && onError(error)
      );
    }

    // is action
    if (obj.$$type === "action") {
      return options.handleAction(obj, options, onSuccess, onError);
    }

    // is iterator
    if (typeof obj.next === "function") {
      function next(payload) {
        if (ct.cancelled) return;
        const { done, value } = obj.next(payload);
        if (done) {
          return onSuccess(value);
        }
        return process(value, options, next, onError);
      }
      return next();
    }

    if ("invalidate" in obj) {
      if (options.addDependency) {
        if (Array.isArray(obj.invalidate)) {
          obj.invalidate.forEach((x) => options.addDependency("invalidate", x));
        } else {
          options.addDependency("invalidate", obj.invalidate);
        }
      }
      return onSuccess();
    }

    // dispatch action
    if ("action" in obj) {
      return options.dispatch(
        obj.action,
        obj.payload,
        options,
        onSuccess,
        onError
      );
    }

    if ("all" in obj) {
      return wait(true, obj.all, options, onSuccess, onError);
    }

    if ("any" in obj) {
      return wait(false, obj.any, options, onSuccess, onError);
    }

    if ("fork" in obj) {
      return process(obj.fork, options);
    }
  }

  throw new Error("Invalid yield expression");
}

function wait(all, target, options, onSuccess = NOOP, onError = NOOP) {
  const ct = options.ct || EMPTY_OBJECT;
  const entries = Object.entries(target);
  const unsubscribes = [];
  const results = Array.isArray(target) ? [] : {};
  let done = false;
  let doneCount = 0;

  function dispose() {
    unsubscribes.forEach((x) => x());
  }

  function callback(key, value, hasError) {
    if (done) return;

    if (ct.cancelled) {
      dispose();
      return;
    }

    if (hasError) {
      done = true;
    } else {
      doneCount++;
      results[key] = value;

      if (all) {
        if (doneCount >= entries.length) {
          done = true;
        }
      } else {
        done = true;
      }
    }

    if (done) {
      dispose();
      return hasError ? onError(value) : onSuccess(results);
    }
  }

  entries.forEach(([key, value]) => {
    if (typeof value === "string") {
      unsubscribes.push(options.subscribe(value, callback));
      return;
    }

    process(
      value,
      options,
      (result) => callback(key, result, false),
      (error) => callback(key, error, true)
    );
  });
}

export function delay(ms, value) {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}
