import * as nodemailer from 'nodemailer';

const global = {
    mail: "easycredit4321@gmail.com",
}


const emisor = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "easycredit4321@gmail.com",
        pass: "cvmovrshtbmlpusa",
    },
});

emisor.verify((error, sucess) => {
    if (error) {
        console.log(error);
        return;
    }
});

//* funciones de envio
export const sendCodeVerification = (email, code) => {
    const subject = "Verificacion de tu correo";

    let mailOptions = {
        from: global.mail,
        to: email,
        subject: subject,
        html: `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Document</title>
    </head>
    <body style="display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; margin: 0; padding: 0; box-sizing: border-box; font-family: BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: white;">
        <div style="background-color:#1e1e1e; width: 40rem; border-radius: 8px; padding: 1rem;">
            <header style="display:flex; align-items:center; justify-content:center; gap:.5rem; padding:1rem;">
                <img class="logo" src="https://i.ibb.co/2YY9XJf/Logo-no-background-no-text.png" style="height: 3rem; width: 3rem;">
                <h3 style="font-size: 1.5rem;">Parcify</h3>
            </header>
            <section style="gap: 1rem; padding: 1rem;">
                <article style="gap: 1rem; border-radius: 4px; align-items: center; justify-content: center; background-color: rgb(236, 236, 236);">
                    <img src="https://i.ibb.co/wrQFgwY/Mockup-Parcify-Copy.png" alt="Mockup-Parcify-Copy" border="0" />
                </article>
                <article style="gap: 1rem;">
                    <p style="color: #B3B3B3; font-size: 1.5rem;">You're one step away</p>
                    <h1 style="font-size: 4rem;">Verify your email address</h1>
                    <p style="color: #B3B3B3; font-size: 1.5rem;">To complete your profile and start unleashing your creativity with Parcify, you need to verify your email</p>
                </article>
                <article style="gap: 1.5rem;">
                    <p style="color: #B3B3B3; font-size: 1.5rem;">Please insert this code in your Parcify:</p>
                    <div style="align-items: center; justify-content: center; padding: 1rem;">
                        <h2 style="height: fit-content; width: fit-content; padding: 12px 4px; border-radius: 8px; display:flex; align-items:center; justify-content:center; background-color: #1971ff; font-weight: bold; font-size: 2.3rem; letter-spacing: 2px; font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;">
                            ${code}
                        </h2>
                    </div>
                </article>
            </section>
            <footer style="border-top: 3px solid rgba(128, 128, 128, 0.501); padding: 1rem; gap: 1.5rem;">
                <h3 style="font-size: 1.5rem;">Contact us</h3>
                <div style="gap: 1rem;">
                    <p style="display: flex; align-items: center; gap: .5rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-phone"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        <span>+57 00 000 000</span>
                    </p>
                    <p style="display: flex; align-items: center; gap: .5rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mail"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                        <span>Parcify@outlook.com</span>
                    </p>
                    <p style="display: flex; align-items: center; gap: .5rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copyright"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg>
                        <span>Parcify, Inc</span>
                    </p>
                </div>
            </footer>
        </div>
    </body>
    </html>`
    };

    console.log("Enviando correo de verificacion");

    emisor.sendMail(mailOptions, (error, info) => {
        if (error) {
            res.status(400).send({ state: "Bad Request", message: "No se pudo enviar el correo" });
            return;
        }
        res.status(200).send({ state: "Good Request", message: "Correo Enviado" });
        return;
    });

};

export const sendPromotion = () => {};
export const sendReward = () => {};

