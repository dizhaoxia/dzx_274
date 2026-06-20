/**
 * Express 应用：健康检查与（生产环境）静态资源托管。
 * 实时能力由 Socket.IO 在 server.ts 中接入。
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api/health", (_req: Request, res: Response, _next: NextFunction): void => {
  res.status(200).json({ success: true, message: "ok" });
});

// 生产环境托管前端构建产物
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(__dirname, "../dist");
  app.use(express.static(dist));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ success: false, error: "Server internal error" });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: "API not found" });
});

export default app;
