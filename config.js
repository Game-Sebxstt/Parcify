export const isDev = true // Estado del proyecto, si es true es desarrollo, si es false es producción
export const isDevDB = true // Estado de la base de datos, si es true es desarrollo, si es false es producción

export const URL_BASIC_PROD = 'https://parcify-api.vercel.app'; // URL de la api para produccion
export const URL_BASIC_DEV = 'http://localhost:4000'; // URL de la api para produccion
export const DEFAULT_API_URL = (isDev ? URL_BASIC_DEV : URL_BASIC_PROD); // URL de la api segun el estado del proyecto

export const URL_SOCKET_PROD = 'wss://parcify-api.vercel.app'; // URL del socket para produccion
export const URL_SOCKET_DEV = 'ws://localhost:4000'; // URL del socket para desarrollo
export const DEFAULT_SOCKET_URL = isDev ? URL_SOCKET_DEV : URL_SOCKET_PROD; // URL del socket segun el estado del proyecto

export const DATABASE_OBJECT_DEV = { // Objeto de la base de datos para desarrollo
    connectionLimit: 10,
    host: "localhost",
    database: "parcify",
    user: "root",
    password: "",
}

export const DATABASE_OBJECT_PROD = { // Objeto de la base de datos para producción (Prueba)
    connectionLimit: 10,
    host: "bc9mbnmlnmifmxejrfrg-mysql.services.clever-cloud.com",
    database: "bc9mbnmlnmifmxejrfrg",
    user: "ungc7pu4kqmidwtf",
    password: "fwiYtIrZ0MJRGpb6y1y0",
}

export const DATABASE_OBJECT = isDevDB ? DATABASE_OBJECT_DEV : DATABASE_OBJECT_PROD; // Objeto de la base de datos segun el estado de la base de datos