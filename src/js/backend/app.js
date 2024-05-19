import express from "express";
import { getConnection } from "./database.js";

const app = express();
const port = process.env.PORT || 4000;

//* parsear a formato yeison
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4321');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
});

app.listen(port, () => {
    console.log(`listening on port ${port}`)
})

//get
//post

//* endpoints

//? registro
app.post('/register/auth', async (req, res) => {

    if (!req.body) {
        res.status(400).send({
            status: "Bad request",
            message: "the register is not succesful"
        });
    }

    //datos
    const { username, email, password } = req.body;

    //conexion con la base
    const connection = await getConnection();

    //Verificiar credenciales
    const emailExist = await connection.query("SELECT email FROM users WHERE email = ?", [email]);

    if (emailExist.length > 0) {
        return res.status(400).json({ message: "Email already exist" })//No esta mal, perooooo
    }

    let id = await generateIdUser(connection);

    //consulta a la base de datos
    const send_data = await connection.query("INSERT INTO users (user_id, username, email, password) VALUES (?, ?, ?, ?)", [id, username, email, password]);

    if (!send_data) {
        return res.status(400).json({ message: "Error in the database" })
    }

    //respuesta
    res.status(200).send({ status: "Good request", message: "chupapimuñaño" })
});

//? login
app.post('/login/auth', async (req, res) => {
    if (!req.body) {
        res.status(400).send({ status: "Bad Request", message: "serve caido" })
    }

    console.log("entroo")

    const { email, password } = req.body;

    // conexion con la base
    const connection = await getConnection();

    //consultar datos
    const id = await connection.query("SELECT user_id FROM users WHERE email = ? AND password = ?", [email, password]);

    //validacion si el usuario existe
    if (!id.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "The user doent's existe" })
    }

    res.status(200).send({ status: "Good Request", message: `${id[0].user_id}` })
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