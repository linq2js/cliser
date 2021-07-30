import { createCollection, createStore, delay } from "@cliser/core";
import { Provider, useQuery, useMutation } from "./index";
import { renderHook, act } from "@testing-library/react-hooks";
import { createElement } from "react";

test("simple query", async () => {
  function* getData() {
    yield delay(10);
    done();
    return 100;
  }
  const done = jest.fn();
  const [wrapper] = createWrapper();
  const { result, rerender } = renderHook(() => useQuery(getData), { wrapper });
  expect(result.current.data).toBeUndefined();
  expect(result.current.loading).toBeTruthy();
  await asyncAct(15);
  expect(result.current.data).toBe(100);
  expect(result.current.loading).toBeFalsy();
  expect(done).toBeCalledTimes(1);
  rerender();
  await delay(15);
  expect(done).toBeCalledTimes(1);
  rerender();
  await delay(15);
  expect(done).toBeCalledTimes(1);
});

test("collection dependency", () => {
  const [wrapper, store] = createWrapper();
  const col = createCollection("mycol", [1, 2, 3]);
  function* getData() {
    return yield col.findMany();
  }
  function* add() {
    yield col.insertOne(4);
  }
  const { result } = renderHook(() => useQuery(getData), { wrapper });
  expect(result.current.data).toEqual([1, 2, 3]);
  store.dispatch(add);
  expect(result.current.data).toEqual([1, 2, 3, 4]);
});

function asyncAct(ms) {
  return act(() => delay(ms));
}

function createWrapper(options) {
  const store = createStore(options);
  return [
    ({ children }) => createElement(Provider, { store, children }),
    store,
  ];
}
