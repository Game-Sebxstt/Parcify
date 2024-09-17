import express from 'express';
import * as authController from '../controllers/authController.js';

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/codeVerification', authController.verifyCode);
router.post('/register/cancel', authController.cancelRegistration);
router.post('/resendAuthCode', authController.resendAuthCode);
router.post('/device', authController.registerDevice);

export default router;