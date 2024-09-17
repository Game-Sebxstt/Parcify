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
    console.log("ya puedes enviar correos");
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
                <style>
                    * {
                        color: white;
                        padding: 0;
                        margin: 0;
                        box-sizing: border-box;
                        font-family: BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    }

                    body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        width: 100%;
                    }

                    .container {
                        background-color: #1E1E1E;
                        display: flex;
                        flex-direction: column;
                        width: 40rem;
                        border-radius: 8px;
                        padding: 1rem;
                    }

                    header {
                        display: flex;
                        align-items: center;
                        gap: .5rem;
                        padding: 1rem;
                    }

                    header h3 {
                        font-size: 1.5rem;
                    }

                    section {
                        display: flex;
                        flex-direction: column;
                        gap: 1rem;
                        padding: 1rem;
                    }

                    section article {
                        display: flex;
                        flex-direction: column;
                        gap: 1rem;
                    }

                    .info p {
                        color: #B3B3B3;
                        font-size: 1.5rem;
                    }

                    .info h1 {
                        font-size: 4rem;
                    }

                    .codeContainer {
                        display: flex;
                        flex-direction: column;
                        gap: 1.5rem;
                    }

                    .codeContainer p {
                        color: #B3B3B3;
                        font-size: 1.5rem;
                    }

                    .codeContainer div {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        padding: 1rem;
                    }

                    .codeContainer h2 {
                        height: 6rem;
                        width: 14rem;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background-color: #1971ff;
                        font-weight: bold;
                        font-size: 2.3rem;
                        letter-spacing: 2px;
                        font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;
                    }

                    footer {
                        border-top: 3px solid rgba(128, 128, 128, 0.501);
                        padding: 1rem;
                        display: flex;
                        flex-direction: column;
                        gap: 1.5rem;
                    }

                    footer h3 {
                        font-size: 1.5rem;
                    }

                    footer div {
                        display: flex;
                        flex-direction: column;
                        gap: 1rem;
                    }

                    footer div p {
                        display: flex;
                        align-items: center;
                        gap: .5rem;
                    }

                    .emailIconContainer {
                        border-radius: 4px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        background-color: rgb(236, 236, 236);
                    }

                    .svgEmail {
                        height: 22rem;
                        width: 28rem;
                    }

                    .logo{
                        height: 3rem;
                        width: 3rem;
                    }
                </style>
                <title>Document</title>
            </head>
            <body>
                <main class="container">
                    <header>
                        <img class="logo" src="/Logo-no-background-no-text.svg">
                        <h3>Parcify</h3>
                    </header>
                    <section class="main">
                        <article class="emailIconContainer">
                        </article>
                        <article class="info">
                            <p>You're one step away</p>
                            <h1>Verify your email address</h1>
                            <p>To complete your profile and start unleashing your creativity with Pacify, you need to verify your
                                email</p>
                        </article>
                        <article class="codeContainer">
                            <p>Please insert this code in your Parcify:</p>
                            <div>
                                <h2 class="code">${code}</h2>
                            </div>
                        </article>
                    </section>
                    <footer class="footer">
                        <h3>Contact us</h3>
                        <div>
                            <p>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-phone"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                <span>+57 00 000 000</span>
                            </p>
                            <p>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mail"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                <span>Parcify@outlook.com</span>
                            </p>
                            <p>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copyright"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg>
                                <span>Parcify, Inc</span>
                            </p>
                        </div>
                    </footer>
                </main>
            </body>
            </html>`,
    };

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

