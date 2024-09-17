import mysql from "promise-mysql";
import * as environments from '../../../config.js'

const connection = mysql.createConnection(environments.DATABASE_OBJECT);

const getConnection = async () => await connection;

export { getConnection };
