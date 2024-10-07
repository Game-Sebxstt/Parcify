# Parcify - Plataforma de Gestión Multimedia

![Parcify Logo](./images/logo.png)

## Tabla de Contenidos
1. [Introducción](#introducción)
2. [Descripción del Proyecto](#descripción-del-proyecto)
3. [Características](#características)
4. [Requerimientos del Usuario](#requerimientos-del-usuario)
5. [Instalación](#instalación)
6. [Tecnologías Utilizadas](#tecnologías-utilizadas)
7. [Metodología de Desarrollo](#metodología-de-desarrollo)
8. [Capturas del Proyecto](#capturas-del-proyecto)
9. [Contribuidores](#contribuidores)
10. [Licencia](#licencia)

## Introducción
**Parcify** es una plataforma innovadora diseñada para facilitar la gestión multimedia para estudiantes, profesionales y organizaciones. Esta herramienta permite a los usuarios organizar y subdividir contenido multimedia, optimizando la realización de tareas de diseño como plantillas, diagramas y mucho más. **Parcify** fomenta el trabajo colaborativo, mejorando la productividad en proyectos creativos.

## Descripción del Proyecto
**Parcify** simplifica el control de multimedia, permitiendo a los usuarios crear, gestionar y colaborar en contenido como imágenes, texto, diagramas y diseños en un entorno intuitivo y accesible. La plataforma proporciona herramientas para la colaboración en tiempo real y el control total de cada componente del proyecto.

> ### **Objetivo**: Mejorar la experiencia del usuario mediante la integración de herramientas avanzadas de gestión y diseño multimedia.

## Características
1. **Plantillas personalizables**: Los usuarios pueden crear nuevas plantillas o utilizar las ya prediseñadas.
2. **Colaboración en tiempo real**: Varios usuarios pueden colaborar simultáneamente en un proyecto.
3. **Búsqueda avanzada**: Herramientas de búsqueda que permiten encontrar rápidamente elementos multimedia.
4. **Sincronización multiplataforma**: Acceso y edición de proyectos desde diferentes dispositivos.
5. **Gestión de permisos**: Asigna roles y niveles de acceso a colaboradores.
6. **Chat en tiempo real**: Comunicación instantánea entre usuarios.
7. **Visualización de métricas**: Gráficas y tablas sobre la actividad y contribuciones de los usuarios.
8. **Importación y exportación de datos**: Soporte para múltiples formatos de datos.

## Requerimientos del Usuario
- **Habilidades básicas de informática**: Los usuarios deben tener conocimientos generales sobre el uso de software y edición multimedia.
- **Compatibilidad del sistema**:
  - **Sistema operativo**: Windows 7 o superior.
  - **Navegador**: Google Chrome, Firefox o similares.
  - **Hardware mínimo**: 
    - Adaptador de red.
    - Procesador 1.66GHz o superior.
    - Memoria RAM mínima de 4GB.
    - Teclado y ratón.

## Instalación

Para configurar **Parcify** localmente, sigue los siguientes pasos:

1. Clonar el repositorio:
    ```bash
    git clone https://github.com/tuusuario/parcify.git
    ```

2. En la terminal principal, navega al directorio del cliente e instala las dependencias:
    ```bash
    cd parcify
    npm install
    npm start
    ```

3. Abrir una **segunda terminal** y ejecutar el servidor backend:
    ```bash
    cd server
    npm install
    npm start
    ```

4. **Importar la base de datos**:
    - Importar el archivo de la base de datos MySQL proporcionado en el gestor de base de datos.
    - Configurar las credenciales de la base de datos en el archivo de entorno.

5. Abrir la aplicación en el navegador:
    ```
    http://localhost:3000
    ```

## Tecnologías Utilizadas
- **Frontend**: Astro, TailwindCSS.
- **Backend**: Node.js.
- **Base de datos**: MySQL.
- **Otras**: JavaScript, TypeScript, APIs para colaboración en tiempo real.

## Metodología de Desarrollo
El desarrollo de **Parcify** sigue la metodología **Scrum**, enfocado en iteraciones mediante sprints:

1. **Planificación**: Definición de metas y asignación de tareas por sprint.
2. **Desarrollo**: Reuniones diarias, codificación y pruebas.
3. **Revisión y retrospectiva**: Evaluación del trabajo realizado y feedback.
4. **Liberación**: Al final de los sprints, se realizan pruebas finales y despliegue del producto.

## Capturas del Proyecto
A continuación se muestran algunas capturas de pantalla del proyecto:

### Vista de Inicio
![Vista de Inicio](./images/home.png)

### Pantalla de Edición
![Pantalla de Edición](./images/editor.png)

### Colaboración en tiempo real
![Colaboración](./images/collaboration.png)

## Contribuidores
- **Sebastian Garces Gomez** - Líder del Proyecto, Desarrollador, QA.
- **Luis Brieva Canchilla** - Diseñador de Software, Ingeniero Backend.
- **Isail Flórez Garces** - Tester QA.
- **Luis Ladeuth Castro** - Diseñador UI/UX.
- **Marcos Jacome Beltran** - Gestor de Configuración.

## Licencia
Este proyecto está licenciado bajo la Licencia MIT. Ver el archivo [LICENSE](./LICENSE) para más detalles.
