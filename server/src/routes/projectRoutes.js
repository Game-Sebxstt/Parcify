import express from 'express';
import * as projectController from '../controllers/projectController.js';

const router = express.Router();

router.get("/collaborators", projectController.getProjectCollaborators);
router.post('/create', projectController.createProject);
router.post('/delete', projectController.deleteProject);
router.post('/deleteList', projectController.deleteProjectList);
router.post('/duplicate', projectController.duplicateProject);
router.post('/duplicateList', projectController.duplicateProjectList);
router.post("/rename", projectController.renameProject)
router.post("/save", projectController.saveProject);
router.post("/collaborators", projectController.saveCollaborators);

export default router;