export const getApiUrl = () => {
    return import.meta.env.PUBLIC_IS_DEV === 'true' ? import.meta.env.PUBLIC_URL_BASIC_DEV : import.meta.env.PUBLIC_URL_BASIC_PROD;
};

export const getSocketUrl = () => {
    return import.meta.env.PUBLIC_IS_DEV === 'true' ? import.meta.env.PUBLIC_URL_SOCKET_DEV : import.meta.env.PUBLIC_URL_SOCKET_PROD;
};