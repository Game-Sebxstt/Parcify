
export function formatNumber(num) {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(1) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(1) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(1) + 'k';
    } else {
        return num;
    }
}

export function formatEmail(email) {
    const [user, domain] = email.split("@");
    const visibleChars = Math.ceil(user.length * 0.3);

    if (user.length <= visibleChars) {
        return email;
    }

    const hiddenPart = "*".repeat(user.length - visibleChars);
    const formattedEmail = `${user.slice(0, visibleChars)}${hiddenPart}@${domain}`;

    return formattedEmail;
}

export function lastModified(fechas) {
    const fechasObjeto = fechas.map((fecha) => new Date(fecha));
    const ultimaModificacion = new Date(Math.max(...fechasObjeto));
    const ahora = new Date();

    const diferencia = ahora - ultimaModificacion;

    const segundos = Math.floor(diferencia / 1000);
    const minutos = Math.floor(segundos / 60);
    const horas = Math.floor(minutos / 60);
    const dias = Math.floor(horas / 24);
    const meses = Math.floor(dias / 30);
    const años = Math.floor(meses / 12);

    if (años > 0) {
        return `${años} año${años !== 1 ? 's' : ''}`;
    } else if (meses > 0) {
        return `${meses} mes${meses !== 1 ? 'es' : ''}`;
    } else if (dias > 0) {
        return `${dias} día${dias !== 1 ? 's' : ''}`;
    } else if (horas > 0) {
        return `${horas} hora${horas !== 1 ? 's' : ''}`;
    } else if (minutos > 0) {
        return `${minutos} minuto${minutos !== 1 ? 's' : ''}`;
    } else {
        return `${segundos} segundo${segundos !== 1 ? 's' : ''}`;
    }
}

export function generateID(){
    return Math.random().toString(36).substr(2, 9);
}

export function isNewProject(last_modified){
    const threeHoursAgo = new Date().getTime() - (2 * 60 * 60 * 1000); 
    const lastModifiedTime = new Date(last_modified).getTime(); 
    return lastModifiedTime >= threeHoursAgo;
}