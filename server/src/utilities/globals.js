import CryptoJS from 'crypto-js';

export async function generateIdUser(connection) {
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

export async function generateIdProject(connection) {
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

export function encrypt(value){
    return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);
}

export function compareEncrypt(compare, value){
    const compareHash = encrypt(compare);
    return compareHash === value;
}

export function generateCodeAuth(){
    return Math.floor(1000 + Math.random() * 9000);
}

export function generateDeviceCode() {
    return Math.floor(10000 + Math.random() * 90000);
}