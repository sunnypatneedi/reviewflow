import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reviewflowRouter from "./reviewflow";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reviewflowRouter);

export default router;
