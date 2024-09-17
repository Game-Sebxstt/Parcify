import express from 'express';
import * as templateController from '../controllers/templateController.js';

const router = express.Router();

router.get("/templates", templateController.getAllTemplates);
router.get("/:id_template", templateController.getTemplateById);
router.post("/like", templateController.likeTemplate);
router.post("/dislike", templateController.dislikeTemplate);

export default router;