export const isDev = true
export const isDevDB = true

export const URL_BASIC_PROD = 'https://parcify-api.vercel.app';
export const URL_BASIC_DEV = 'http://localhost:4000';
export const DEFAULT_API_URL = (isDev ? URL_BASIC_DEV : URL_BASIC_PROD);

export const URL_SOCKET_PROD = 'wss://parcify-api.vercel.app';
export const URL_SOCKET_DEV = 'ws://localhost:4000';
export const DEFAULT_SOCKET_URL = isDev ? URL_SOCKET_DEV : URL_SOCKET_PROD;

export const DATABASE_OBJECT_DEV = {
    connectionLimit: 10,
    host: "localhost",
    database: "parcify",
    user: "root",
    password: "",
}

export const DATABASE_OBJECT_PROD = {
    connectionLimit: 10,
    host: "bzic2wrqo4ogzg5qu30t-mysql.services.clever-cloud.com",
    database: "bzic2wrqo4ogzg5qu30t",
    user: "udgfj2luotgt639t",
    password: "8ZfG5u1B0orFV0fhyNow",
}

export const DATABASE_OBJECT = isDevDB ? DATABASE_OBJECT_DEV : DATABASE_OBJECT_PROD;