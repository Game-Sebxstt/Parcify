import mysql from "promise-mysql";

const connection = mysql.createConnection({
    host: "bzic2wrqo4ogzg5qu30t-mysql.services.clever-cloud.com",
    database: "bzic2wrqo4ogzg5qu30t",
    user: "udgfj2luotgt639t",
    password: "8ZfG5u1B0orFV0fhyNow",
});

const getConnection = async () => await connection;

export { getConnection };
