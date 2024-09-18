import express from 'express';
import * as userController from '../controllers/userController.js';

const router = express.Router();

router.get("/data", userController.getUserData);
router.get("/projects", userController.getUserProjects);
router.get("/project", userController.getProjectById);
router.get("/preferences", userController.getPreferencesUser)
router.post("/updateProfile", userController.updateProfile)
router.post("/updateImageProfile", userController.updateImageProfile)
router.post('/checkPassword', userController.checkPassword);
router.post("/updatePassword", userController.updatePassword);
router.post("/invitation/send", userController.sendInvitationProject);

export default router;