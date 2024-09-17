import express from 'express';
import * as preferencesController from '../controllers/preferencesController.js';

const router = express.Router();

router.post("/favorite", preferencesController.addFavorite);
router.get("/data", preferencesController.getFavorites);
router.delete("/favorite", preferencesController.deleteFavorite);

export default router;