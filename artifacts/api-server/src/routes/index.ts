import { Router } from "express";
import healthRouter from "./health";
import spacesRouter from "./spaces";
import tagsRouter from "./tags";
import lettersRouter from "./letters";
import messagesRouter from "./messages";
import meRouter from "./me";
import profileRouter from "./profile";
import uploadRouter from "./upload";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import userEventsRouter from "./user-events";

const router = Router();

router.use(healthRouter);
router.use(spacesRouter);
router.use(tagsRouter);
router.use(lettersRouter);
router.use(messagesRouter);
router.use(meRouter);
router.use(profileRouter);
router.use(uploadRouter);
router.use(notificationsRouter);
router.use(adminRouter);
router.use(userEventsRouter);

export default router;
