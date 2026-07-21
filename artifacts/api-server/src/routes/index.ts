import { Router } from "express";
import healthRouter from "./health";
import spacesRouter from "./spaces";
import tagsRouter from "./tags";
import lettersRouter from "./letters";
import messagesRouter from "./messages";
import meRouter from "./me";
import profileRouter from "./profile";
import uploadRouter from "./upload";

const router = Router();

router.use(healthRouter);
router.use(spacesRouter);
router.use(tagsRouter);
router.use(lettersRouter);
router.use(messagesRouter);
router.use(meRouter);
router.use(profileRouter);
router.use(uploadRouter);

export default router;
