import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import CryptoJS from 'crypto-js';
import { createServer } from 'node:http';
// import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';
import { getConnection } from "./database.js";

const app = express();
const server = createServer(app);

const port = process.env.PORT || 4000;

// Configuración inicial
app.set("port", port);

// Middlewares
// app.use(express.limit(100000000));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = ['http://localhost:4321', 'http://localhost:4322', 'https://1rhbb29z-4321.use2.devtunnels.ms', 'https://7qjgdqdv-4321.use2.devtunnels.ms'];
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error('No permitido por CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(morgan("dev"));
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permite solicitudes desde cualquier origen
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE'); // Métodos permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Encabezados permitidos
    next();
});

server.listen(app.get("port"));
console.log("Escuchando el puerto " + app.get("port"));

app.post('/register/auth', async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty"});
    }

    const { username, email, password } = req.body;
    const connection = await getConnection();

    const emailExist = await connection.query("SELECT email FROM users WHERE email = ?", [email]);
    if (emailExist.length > 0) {
        return res.status(400).json({ message: "El Correo Electronico ya existe." })
    }

    let id = await generateIdUser(connection);
    const send_data = await connection.query("INSERT INTO users (user_id, username, email, password) VALUES (?, ?, ?, ?)", [id, username, email, encrypt(password)]);

    if (!send_data) {
        return res.status(400).json({ message: "Error in the database" })
    }

    res.status(200).send({ status: "Good request", message: "User register successfull" })
});

app.post('/login/auth', async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { email, password } = req.body;
    const connection = await getConnection();

    const id = await connection.query("SELECT user_id FROM users WHERE email = ? AND password = ?", [email, encrypt(password)]);
    if (!id.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    res.status(200).send({ status: "Good Request", message: id[0].user_id })
});

app.post("/project/create", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id, name, template_id} = req.body;

    const connection = await getConnection();
    const userExist = await connection.query("SELECT user_id FROM users WHERE user_id = ?", [id]);

    if(!userExist.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    let template = await connection.query("SELECT stage, preview FROM templates WHERE template_id = ?", [template_id]);
    
    if(!template.length > 0){
        template = [
            {
                stage: "",
                preview: ""
            }
        ]
    }

    const project_id = await generateIdProject(connection);
    const date_now = new Date();
    const data = await connection.query("INSERT INTO projects (project_id, user_id, name, preview, stage, collaborators, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?)",[project_id, id, name, template[0].preview, template[0].stage, "", date_now]);

    if (!data) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo crear el proyecto" })
    }

    return res.status(200).send({state: "Good Request", message: project_id})
})

app.post("/project/delete", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id_project } = req.body;

    const connection = await getConnection();
    const data = await connection.query("DELETE FROM projects WHERE project_id = ?", [id_project]);

    if(!data){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo eliminar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: "El proyecto se elimino correctamente." })
})

app.post("/project/duplicate", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id_project } = req.body;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." })
    }

    const project_id = await generateIdProject(connection);
    const date_now = new Date();
    const duplicate = await connection.query("INSERT INTO projects (project_id, user_id, name, stage, preview, collaborators, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?)",[project_id, data[0].user_id, data[0].name, data[0].stage, data[0].preview, data[0].collaborators, date_now]);

    if(!duplicate){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo duplicar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: project_id })
})

//Cambio de nombre
app.post("/project/rename", async (req,res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }
    const { id_project, name } = req.body;

    const connection = await getConnection();
    const [data] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if (data.length === 0) {
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." });
    }

    const result = await connection.query("UPDATE projects SET name = ? WHERE project_id = ?", [name, id_project]);

    if (result.affectedRows === 0) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo cambiar el nombre al proyecto." });
    }

    return res.status(200).send({ status: "Good Request", message: "Nombre del proyecto actualizado correctamente." });
})

app.post("/project/save", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const {stage, project_id, preview} = req.body;

    const connection = await getConnection();
    const update_project = await connection.query("UPDATE projects SET stage = ?, preview = ? WHERE project_id = ?", [stage, preview, project_id]);


    if(!update_project){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: "El proyecto se guardo correctamente." })
});

app.post("/preferences/favorite", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const {id, id_project, type} = req.body;
    const connection = await getConnection();

    let favorites = [];

    // Consulta para ver si el usuario ya tiene favoritos almacenados
    const userExist = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id]);

    if (userExist.length > 0) {
        let actualFavorite = userExist[0].favorites ? JSON.parse(userExist[0].favorites) : [];

        // Asegúrate de que `actualFavorite` es un array
        if (!Array.isArray(actualFavorite)) {
            actualFavorite = [];
        }

        const isDuplicate = actualFavorite.some(fav => fav.id === id_project && fav.type === type);

        if (isDuplicate) {
            return res.status(200).send({ status: "No Action", message: "Favorite already exists" });
        }

        // Agrega el nuevo favorito al array existente
        actualFavorite.push({ id: id_project, type: type });

        // Convierte el array actualizado en una cadena JSON
        const newFavorites = JSON.stringify(actualFavorite);

        console.log(newFavorites);
        
        const updateFavorite = await connection.query("UPDATE preferences SET favorites = ? WHERE user_id = ?",[newFavorites, id]);

    } else {

        favorites.push({ id: id_project, type: type });

        // Convierte el array actualizado en una cadena JSON
        const newFavorites = JSON.stringify(favorites);

        const addFavorite = await connection.query(`INSERT INTO preferences (user_id, favorites) VALUES (?, ?)`, [id, newFavorites]);
    }

    res.status(200).send({ status: "Good Request", message: "Favorite Succeful" })
});

app.get("/user/data", async (req, res) =>{
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM users WHERE user_id = ?", [id_user]);
    const projects = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);

    if(!data.length > 0 && !projects.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    data[0].password = undefined;

    const info_user = {
        users: data[0],
        projects: projects,
    }

    res.status(200).send({ status: "Good Request", message: info_user })
});

//Obtenere todos los proyectos de un usuario
app.get("/user/projects", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no tiene proyectos." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

//Obtener un solo proyecto por su id
app.get("/user/project", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_project = req.query.id_project;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." })
    }

    res.status(200).send({ status: "Good Request", message: data[0] })
});

app.get("/templates", async (req, res) => {
    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM templates ORDER BY date_create ASC");

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "No hay plantillas." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

//search templates
app.get("/templates/search", async (req, res) => {
    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM templates");

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "No hay plantillas." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

app.get("/preferences/data", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT favorites FROM preferences WHERE user_id = ?", [id_user]);
    //console.log(JSON.parse(data));
    if(!data.length > 0 ){
        return res.status(400).send({ status: "Bad Request", message: "No se encuentran favoritos." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});


async function generateIdUser(connection) {
    let user_id;
    let isAvailable = false;
    let attempts = 0;
    let min = 9999;
    let max = 999999;
    const maxAttempts = 100;

    while (!isAvailable && attempts < maxAttempts) {
        user_id = Math.floor(Math.random() * max) + min;

        const userIdExists = await connection.query("SELECT user_id FROM users WHERE user_id = ?", [user_id]);
        if (userIdExists.length === 0) {
            isAvailable = true;
        }

        attempts++;
    }

    if (attempts >= maxAttempts) {
        return null;
    }

    return user_id;
}

async function generateIdProject(connection) {
    let project_id;
    let isAvailable = false;
    let attempts = 0;
    let min = 9999;
    let max = 999999;
    const maxAttempts = 100;

    while (!isAvailable && attempts < maxAttempts) {
        project_id = Math.floor(Math.random() * max) + min;

        const userIdExists = await connection.query("SELECT project_id FROM projects WHERE project_id = ?", [project_id]);
        if (userIdExists.length === 0) {
            isAvailable = true;
        }

        attempts++;
    }

    if (attempts >= maxAttempts) {
        return null;
    }

    return project_id;
}

function encrypt(value){
    return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);
}

function compareEncrypt(compare, value){
    return compare == encrypt(value);
}