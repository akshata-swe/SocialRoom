import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// Store uploads in a local directory (serve them statically)
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.use("/uploads", (req, res, next) => {
  const filePath = path.join(uploadDir, path.basename(req.path));
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const url = `/api/uploads/${req.file.filename}`;
    res.json({
      url,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  },
);

export default router;
