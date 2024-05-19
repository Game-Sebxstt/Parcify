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
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = ['http://localhost:4321', 'http://localhost:4322', ''];
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
        res.status(400).send({ status: "Bad Request", message: "Body is empty"});
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
        res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { email, password } = req.body;
    const connection = await getConnection();

    const id = await connection.query("SELECT user_id FROM users WHERE email = ? AND password = ?", [email, encrypt(password)]);
    if (!id.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    res.status(200).send({ status: "Good Request", message: id[0].user_id })
});

app.get("/user/data", async (req, res) =>{
    if (!req.body) {
        res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    //Traer los datos de la base de datos de la tabla llamada  projects
    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM users");
    

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

function encrypt(value){
    return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);
}

function compareEncrypt(compare, value){
    return compare == encrypt(value);
}