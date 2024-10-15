import express from 'express';
import * as generativeController from '../controllers/generativeController.js';

const router = express.Router();

router.post("/generative-canvas", generativeController.generateCanvas);

export default router;