/**
 * 本地开发服务端入口：启动 HTTP 服务并接入 Socket.IO 实时层。
 */
import http from "node:http";
import app from "./app.js";
import { setupRealtime } from "./realtime.js";

const PORT = process.env.PORT || 54343;

const server = http.createServer(app);
setupRealtime(server);

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
