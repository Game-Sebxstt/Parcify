import express from 'express';
import * as userController from '../controllers/userController.js';

const router = express.Router();

router.get("/data", userController.getUserData);
router.get("/projects", userController.getUserProjects);
router.get("/project", userController.getProjectById);
router.post("/updateProfile", userController.updateProfile)
router.post("/updateImageProfile", userController.updateImageProfile)
router.post("/getProfileImage", userController.getProfileImage); // Esto debe ser tipo get
router.post('/checkPassword', userController.checkPassword);
router.post("/updatePassword", userController.updatePassword);
router.post("/invitation/send", userController.sendInvitationProject);

export default router;