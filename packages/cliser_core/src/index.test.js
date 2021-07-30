import { createCollection, createStore, delay } from "./index";

test("store", () => {
  const todoList = createCollection("todo", ["item 1", "item 2"]);
  const onTodoChange = jest.fn();
  const onAnyChange = jest.fn();
  const store = createStore();

  function* insertTodo(title) {
    yield todoList.insertOne(title);
  }

  store.subscribe(onAnyChange);
  store.subscribe("collection:todo", onTodoChange);

  store.dispatch(insertTodo, "item 3");
  store.dispatch(insertTodo, "item 4");

  expect(todoList.items).toEqual(["item 1", "item 2", "item 3", "item 4"]);
  expect(onAnyChange).toBeCalledTimes(2);
  expect(onTodoChange).toBeCalledTimes(2);
});

test("remote collection", () => {
  let dispatchings = [];
  const todoList = createCollection("todo", "database");
  const databaseConnection = {
    dispatch(info) {
      dispatchings.push(info);
    },
  };
  function* insertTodo(title) {
    yield todoList.insertOne(title);
  }
  const store = createStore({
    connections: {
      database: databaseConnection,
    },
  });
  store.dispatch(insertTodo, "item 1");
  expect(dispatchings[0]).toMatchObject({
    action: "insertOne",
    collection: { name: "todo", storage: "database" },
  });
});

test("yield promise", async () => {
  const done = jest.fn();
  const store = createStore();
  function* action() {
    yield delay(10);
    done();
  }
  store.dispatch(action);
  expect(done).toBeCalledTimes(0);
  await delay(15);
  expect(done).toBeCalledTimes(1);
});

test("wait an action", () => {
  const done = jest.fn();
  const store = createStore();
  function* action() {
    const payload = yield "do-something";
    done(payload);
  }
  store.dispatch(action);
  expect(done).toBeCalledTimes(0);
  store.dispatch("do-something", 1);
  expect(done).toBeCalledWith(1);
});
