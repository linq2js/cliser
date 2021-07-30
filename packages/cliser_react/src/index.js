import { createEmitter, EMPTY_ARRAY, EMPTY_OBJECT, NOOP } from "@cliser/core";
import {
  createElement,
  useContext,
  createContext,
  useRef,
  useState,
  useEffect,
} from "react";

const controllerContext = createContext();

export function Provider({ store, suspense, children }) {
  const ref = useRef();
  if (!ref.current || ref.current.store !== store) {
    ref.current = createController(store);
  }

  useEffect(() => ref.current.dispose, []);

  ref.current.suspense = suspense;

  return createElement(controllerContext.Provider, {
    value: ref.current,
    children,
  });
}

function createController(store) {
  const gcQueue = new Map();
  const dispatchers = new Map();
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    gcQueue.forEach((item) => {
      disposeDispatcher(item.action);
      clearGcItem(item.action);
    });
    gcQueue.clear();
  }

  function disposeDispatcher(action) {
    const dispatcher = dispatchers.get(action);
    if (dispatcher) dispatcher.dispose();
    clearGcItem(action);
  }

  function clearGcItem(action) {
    const item = gcQueue.get(action);
    if (item) clearTimeout(item.timer);
  }

  function gc(action, expiredIn = 1000 * 60 * 5) {
    if (disposed) {
      return disposeDispatcher(action);
    }
    gcQueue.set(action, {
      action,
      timer: setTimeout(disposeDispatcher, expiredIn, action),
    });
    return () => clearGcItem(action);
  }

  const controller = {
    store,
    dispose,
    gc,
    get(action, type) {
      let dispatcher = dispatchers.get(action);
      if (!dispatcher) {
        dispatcher = createDispatcher(action, type, controller);
        dispatchers.set(action, dispatcher);
      }
      return dispatcher;
    },
    remove(action) {
      dispatchers.delete(action);
    },
  };
  return controller;
}

export function useStore() {
  return useController().store;
}

export function useController() {
  return useContext(controllerContext);
}

export function useQuery(query, { lazy, payload } = EMPTY_OBJECT) {
  const controller = useController();
  const ref = useRef({}).current;
  const rerender = useState()[1];
  ref.update = () => rerender({});
  ref.dispatcher = controller.get(query, "query");
  ref.dispatcher.link(ref);
  if (!lazy) ref.dispatcher.fetch(payload);
  useEffect(() => () => ref.dispatcher.unlink(ref), [ref]);
  return ref.dispatcher;
}

export function useMutation(mutation, {} = EMPTY_OBJECT) {
  const controller = useController();
  const ref = useRef({}).current;
  const rerender = useState()[1];
  ref.update = () => rerender({});
  ref.dispatcher = controller.get(mutation, "mutation");
  ref.dispatcher.link(ref);
  useEffect(() => () => ref.dispatcher.unlink(ref), [ref]);
  return ref.dispatcher;
}

function createDispatcher(action, type, controller) {
  const store = controller.store;
  const emitter = createEmitter();
  const links = new Set();
  const dependencyUpdateListeners = new Map();
  const dispatcher = {
    get status() {
      return status;
    },
    get loading() {
      return status === "loading";
    },
    get fail() {
      return status === "fail";
    },
    get pending() {
      return status === "pending";
    },
    get success() {
      return status === "success";
    },
    get data() {
      if (controller.suspense) {
        if (status === "loading") throw promise;
        if (status === "fail") throw error;
      }
      return data;
    },
    set data(value) {
      data = value;
      status = "success";
      promise = Promise.resolve(data);
      notifyUpdate();
    },
    get error() {
      return error;
    },
    set error(value) {
      error = value;
      status = "fail";
      promise = Promise.reject(data);
      notifyUpdate();
    },
    get promise() {
      if (!promise) {
        const p = (promise = new Promise((resolve, reject) => {
          const unsubscribe = emitter.on("update", () => {
            // still have nothing change
            if (p === promise) return;
            unsubscribe();
            promise.then(resolve, reject);
          });
        }));
      }
      return promise;
    },
    fetch,
    refetch,
    cancel,
    dispose,
    update,
    then() {
      return dispatcher.promise.then(...arguments);
    },
    finally() {
      return dispatcher.promise.finally(...arguments);
    },
    catch() {
      return dispatcher.promise.catch(...arguments);
    },
    link(link) {
      links.add(link);
      cancelGc && cancelGc();
      cancelGc = null;
    },
    unlink(link) {
      links.delete(link);
      if (!links.size) {
        cancelGc = controller.gc(action);
      }
    },
  };
  let disposed = false;
  let promise;
  let status = "pending";
  let data;
  let error;
  let prevPayload;
  let ct;
  let cancelGc;
  let dispatched = false;

  function update(newData) {
    if (typeof newData === "function") {
      newData = newData(data);
    }
    dispatcher.data = newData;
    return dispatcher;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearDependencies();
    cancelGc && cancelGc();
    controller.remove(action);
  }

  function clearDependencies() {
    dependencyUpdateListeners.forEach((unsubscribe) => unsubscribe());
    dependencyUpdateListeners.clear();
  }

  function fetch(payload) {
    if (!arguments.length) payload = prevPayload;
    if (dispatched && type === "query") return dispatcher;
    refetch(payload);
  }

  function cancel() {
    ct && ct.cancel();
  }

  function refetch(payload) {
    if (!arguments.length) payload = prevPayload;
    prevPayload = payload;
    if (type === "query") clearDependencies();
    let isAsync = true;
    promise = new Promise((resolve, reject) => {
      dispatched = true;
      ct = store.dispatch(
        action,
        payload,
        {
          addDependency(depType, dependency) {
            if (type !== "query") return;
            const depKey =
              depType === "collection" ? dependency.name : dependency;
            if (dependencyUpdateListeners.has(depKey)) return;
            dependencyUpdateListeners.set(
              depKey,
              store.subscribe(
                depType === "collection"
                  ? `collection:${dependency.name}`
                  : dependency,
                handleDependencyUpdate
              )
            );
          },
        },
        (result) => {
          isAsync = false;
          dispatcher.data = result;
          resolve(result);
        },
        (error) => {
          isAsync = false;
          dispatcher.error = error;
          reject(error);
        }
      );
    });

    if (isAsync) {
      status = "loading";
      error = null;
      notifyUpdate();
    }

    return dispatcher;
  }

  function notifyUpdate() {
    links.forEach((link) => link.update());
    emitter.emit("update");
  }

  function handleDependencyUpdate() {
    dispatched = false;
    notifyUpdate();
  }

  return dispatcher;
}
