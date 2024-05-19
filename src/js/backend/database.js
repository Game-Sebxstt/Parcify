import mysql from "promise-mysql";

const connection = mysql.createConnection({
    host: "localhost",
    database: "parcify",
    user: "root",
    password: "",
});

const getConnection = async () => await connection;

export { getConnection };
