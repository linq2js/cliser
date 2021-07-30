import { MongoClient, MongoUrl } from "mongodb";

export function createMongoConnection(options = EMPTY_OBJECT) {
  if (typeof options === "string") {
    options = { uri: options };
  }
  const { uri } = options;
  const { DatabaseName } = MongoUrl.create(uri);

  let clientConnected;
  const connect = () => {
    if (clientConnected) return clientConnected;
    return (clientConnected = new Promise(async (resolve) => {
      const client = new MongoClient(uri);
      await client.connect();

      await client.db("admin").command({ ping: 1 });

      console.log("Connected successfully to server");
      resolve(client.db("main"));
    }));
  };

  return {
    dispatch({ collection, action, args }, {}, onSuccess, onError) {},
  };
}
