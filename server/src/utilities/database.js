import mysql from "promise-mysql";
import dotenv from 'dotenv';

dotenv.config();

const IS_DEV_DB = process.env.IS_DEV_DB === 'true';

const connection = mysql.createConnection({
    connectionLimit: 10,
    host: IS_DEV_DB ? process.env.DATABASE_HOST_DEV : process.env.DATABASE_HOST_PROD,
    database: IS_DEV_DB ? process.env.DATABASE_NAME_DEV : process.env.DATABASE_NAME_PROD,
    user: IS_DEV_DB ? process.env.DATABASE_USER_DEV : process.env.DATABASE_USER_PROD,
    password: IS_DEV_DB ? process.env.DATABASE_PASSWORD_DEV : process.env.DATABASE_PASSWORD_PROD,
});

const getConnection = async () => await connection;

export { getConnection };
