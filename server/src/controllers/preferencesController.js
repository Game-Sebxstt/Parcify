import { getConnection } from "../utilities/database.js";
const connection = await getConnection();

export const addFavorite = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { id, id_project, type } = req.body;

    try {
        const [userPreference] = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id]);

        let favorites = [];

        if (userPreference) {
            favorites = userPreference.favorites ? JSON.parse(userPreference.favorites) : [];

            if (!Array.isArray(favorites)) {
                favorites = [];
            }

            const isDuplicate = favorites.some(fav => fav.id === id_project && fav.type === type);

            if (isDuplicate) {
                return res.status(200).send({ state: false, message: "Favorite already exists" });
            }

            favorites.push({ id: id_project, type: type });

            const result = await connection.query("UPDATE preferences SET favorites = ? WHERE user_id = ?", [JSON.stringify(favorites), id]);

            if (result.affectedRows === 0) {
                return res.status(400).send({ state: false, message: "No se pudo guardar el favorito." });
            }
        } else {
            favorites.push({ id: id_project, type: type });

            const result = await connection.query("INSERT INTO preferences (user_id, favorites) VALUES (?, ?)", [id, JSON.stringify(favorites)]);

            if (result.affectedRows === 0) {
                return res.status(400).send({ state: false, message: "No se pudo guardar el favorito." });
            }
        }

        return res.status(200).send({ state: true, message: "Favorito guardado correctamente." });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getFavorites = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const [data] = await connection.query("SELECT favorites FROM preferences WHERE user_id = ?", [id_user]);
    
        if (!data) {
            return res.status(400).send({ state: false, message: "No se encuentran favoritos." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const deleteFavorite = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { id, element } = req.body;

    try {
        const [userPreference] = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id]);

        if (!userPreference) {
            return res.status(404).send({ status: "Not Found", message: "User has no favorites" });
        }

        let favorites = userPreference.favorites ? JSON.parse(userPreference.favorites) : [];

        if (!Array.isArray(favorites)) {
            favorites = [];
        }

        const newFavorites = favorites.filter(fav => fav.id != element);

        if (newFavorites.length === favorites.length) {
            return res.status(404).send({ status: "Not Found", message: "Favorite not found" });
        }

        const result = await connection.query("UPDATE preferences SET favorites = ? WHERE user_id = ?", [JSON.stringify(newFavorites), id]);

        if (result.affectedRows === 0) {
            return res.status(400).send({ state: false, message: "No se pudo eliminar el favorito." });
        }

        return res.status(200).send({ state: true, message: "Favorite removed successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};