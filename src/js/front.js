// Obtener todos los elementos con el ID "filter"
const filter_index = document.querySelectorAll('#filter');

// Agregar evento de clic a cada elemento de filtro
filter_index?.forEach((element, index) => {
    element?.addEventListener("click", () => {
        // Obtener el elemento correspondiente a las opciones de filtro y la flecha de expansión
        const more_options_filter = document.querySelectorAll('#more-options-filter')[index];
        const arrow_down_filter = document.querySelectorAll('#arrow-down-filter')[index];
        
        // Alternar la visualización y rotación del filtro
        if(window.getComputedStyle(more_options_filter).display === 'none'){
            more_options_filter.style.display = 'flex';
            arrow_down_filter.style.transform = 'rotate(180deg)';
        }else{
            more_options_filter.style.display = 'none';
            arrow_down_filter.style.transform = 'rotate(0deg)';
        }
    })
})

const recientesLink = document.querySelector('#recientes');
recientesLink.addEventListener('click', () => {
  const contentGrid = document.querySelector('#content-grid');
  const articleElements = contentGrid.children;
  for (let i = 0; i < articleElements.length; i++) {
    const article = articleElements[i];
    if (i < 2) {
      article.style.display = 'block';
    } else {
      article.style.display = 'none';
    }
  }
});
    //itera el div con id "content-grid" 
const facheritosLink = document.querySelector('#facheritos');
facheritosLink.addEventListener('click', () => {
    const contentGrid = document.querySelector('#content-grid');
    const articleElements = contentGrid.children;
    for (let i = 0; i < articleElements.length; i++) {
      const article = articleElements[i];
      if (i < 4) {
        article.style.display = 'block';
      } else {
        article.style.display = 'none';
      }
    }
  });
      //itera el div con id "content-grid" 
  const compartidoLink = document.querySelector('#compartidos');
  compartidoLink.addEventListener('click', () => {
      const contentGrid = document.querySelector('#content-grid');
      const articleElements = contentGrid.children;
      for (let i = 0; i < articleElements.length; i++) {
        const article = articleElements[i];
        if (i < 1) {
          article.style.display = 'block';
        } else {
          article.style.display = 'none';
        }
      }
    });
    //itera el div con id "content-grid" 
    const todosLink = document.querySelector('#todos');
    todosLink.addEventListener('click', () => {
      const contentGrid = document.querySelector('#content-grid');
      const articleElements = contentGrid.children;
      for (let i = 0; i < articleElements.length; i++) {
        const article = articleElements[i];
        if (i < 7) {
          article.style.display = 'block';
        } else {
          article.style.display = 'none';
        }
      }
    });



// Obtener el elemento con el ID "profile"
const profile = document.querySelector("#profile");

// Agregar evento de clic al perfil para mostrar/ocultar opciones
profile?.addEventListener("click", () => {
    const more_options_profile = document.querySelector("#more-options-profile");
    more_options_profile.style.display = window.getComputedStyle(more_options_profile).display == "none" ? 'flex' : 'none' ;

});

// Obtener todos los elementos con el ID "items-slide"
const items_slide = document.querySelectorAll("#items-slide");

// Agregar evento de clic a cada elemento de la lista de items
items_slide.forEach((element) => {
    element.addEventListener("click", () => {
        // Redirigir al usuario a la URL especificada en el atributo data-uri
        window.location.href = element.getAttribute("data-uri");
    });
})

// Obtener el elemento con el ID "menu-header"
const menu_header = document.querySelector("#menu-header");

// Agregar evento de clic al menú de encabezado para mostrar/ocultar el menú deslizante móvil
menu_header?.addEventListener("click", () => {
    const slide = document.querySelector("#slideMobile");
    if(window.getComputedStyle(slide).left == "0px"){
        slide.style.left = "-100%"
    }else{
        slide.style.left = "0%"
    }
});

// Obtener el elemento con el ID "logo-header-slide"
const logo_header_slide = document.querySelector("#logo-header-slide");

// Agregar evento de clic al logo para redirigir al usuario
logo_header_slide?.addEventListener("click", () => {
    window.location.href = logo_header_slide.getAttribute("data-action");
});

// Obtener el elemento con el ID "bg-close-invite"
const bg_close_invite = document.querySelector("#bg-close-invite");

// Agregar evento de clic al fondo para ocultar la ventana modal y gestionar la visualización de otros elementos
bg_close_invite?.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
    if(window.getComputedStyle(document.getElementById('users-invited')).display == "flex"){
        document.getElementById('users-invited').style.display = 'none'
        document.getElementById('projectContent').style.display = 'flex'
    }
})

// Obtener todos los elementos con el ID "x-close-invite"
const x_close_invite = document.querySelectorAll("#x-close-invite");

// Agregar eventos de clic a los elementos de cierre para ocultar la ventana modal y gestionar la visualización de otros elementos
x_close_invite?.forEach((element, i) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "none";
        if(i != 0){
            document.getElementById('users-invited').style.display = 'none'
            document.getElementById('projectContent').style.display = 'flex'
        }
    })
})

// Obtener todos los elementos con el ID "invite-btn"
const invite_btn = document.querySelectorAll("#invite-btn");

// Agregar eventos de clic a los botones de invitación para mostrar la ventana modal
invite_btn?.forEach((element) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "flex";
    })
});

// Obtener todos los elementos con el ID "menu-btn"
let menu_btn_list = document.querySelectorAll("#menu-btn");

// Agregar eventos de clic a los botones de menú para cambiar el estilo y ocultar/mostrar secciones correspondientes
menu_btn_list.forEach((element) => {
    element.addEventListener("click", () => {
        let attrElement = element.getAttribute("data-section");
        element.style.backgroundColor = "#FC7F53";
        element.style.borderColor = "#ad4b1e";

        menu_btn_list.forEach((item) => {
            if(item != element){
                item.style.backgroundColor = "#595959";
                item.style.borderColor = "transparent";
            }
        });
    });
});

// Obtener el elemento con el ID "close-right-slide"
let close_right_slide = document.querySelector("#close-right-slide");

// Agregar evento de clic para mostrar/ocultar el panel lateral derecho
close_right_slide?.addEventListener("click", () => {
    document.querySelector("#right-slide").style.right = window.getComputedStyle(document.querySelector("#right-slide")).right == "0px" ? "-25rem" : "0px";
});

// Obtener el elemento con el ID "close-left-slide"
let close_left_slide = document.querySelector("#close-left-slide");

// Agregar evento de clic para mostrar/ocultar el panel lateral izquierdo
close_left_slide?.addEventListener("click", () => {
    document.querySelector("#left-slide").style.left = window.getComputedStyle(document.querySelector("#left-slide")).left == "0px" ? "-25rem" : "0px";
});

// Obtener todos los elementos con el ID "menu-btn"
let menu_btn = document.querySelectorAll("#menu-btn");

// Agregar eventos de clic a los botones de menú para mostrar/ocultar secciones correspondientes
menu_btn.forEach(element => {
    element.addEventListener("click", () => {
        let attr = element.getAttribute("data-section");
        let sections_options = document.querySelectorAll(".section_option");

        sections_options.forEach(element => {
            if(element.id == attr){
                element.style.display = "flex";
            }else{
                element.style.display = "none";
            }
        })      
    });
});

// // Código comentado
// invite_btn?.addEventListener("click", () => {
//     document.querySelector("#popup-invite").style.display = "flex";
// });