require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { createStore } = require("@cliser/core");
const { createMongoConnection } = require("@cliser/mongo");
const app = express();
const port = process.env.PORT || 8000;
const server = http.createServer(app);

const store = createStore({
  connections: {
    default: createMongoConnection(process.env.DATABASE_CONNECTION),
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use("/", (req, res) => res.send("OK"));

server.on("error", (error) => {
  if (error.syscall !== "listen") {
    throw error;
  }
  switch (error.code) {
    case "EACCES":
      console.error(`Port ${port} requires elevated privileges`);
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(`Port ${port} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

server.listen(port, () => {
  console.log("Server listening on port", port);
});
