const filter_index = document.querySelectorAll('#filter');

filter_index?.forEach((element, index) => {
    element?.addEventListener("click", () => {
        const more_options_filter = document.querySelectorAll('#more-options-filter')[index];
        const arrow_down_filter = document.querySelectorAll('#arrow-down-filter')[index];
        if(window.getComputedStyle(more_options_filter).display === 'none'){
            more_options_filter.style.display = 'flex';
            arrow_down_filter.style.transform = 'rotate(180deg)';
        }else{
            more_options_filter.style.display = 'none';
            arrow_down_filter.style.transform = 'rotate(0deg)';
        }
    })
})

const items_slide = document.querySelectorAll("#items-slide");

items_slide.forEach((element) => {
    element.addEventListener("click", () => {
        window.location.href = element.getAttribute("data-uri");
    });
})

const menu_header = document.querySelector("#menu-header");

menu_header?.addEventListener("click", () => {
    const slide = document.querySelector("#slideMobile");
    if(window.getComputedStyle(slide).left == "0px"){
        slide.style.left = "-100%"
    }else{
        slide.style.left = "0%"
    }
});

const logo_header_slide = document.querySelector("#logo-header-slide");

logo_header_slide?.addEventListener("click", () => {
    window.location.href = logo_header_slide.getAttribute("data-action");
});

const bg_close_invite = document.querySelector("#bg-close-invite");

bg_close_invite?.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
})

const x_close_invite = document.querySelector("#x-close-invite");

x_close_invite?.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
})

const invite_btn = document.querySelectorAll("#invite-btn");

invite_btn?.forEach((element) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "flex";
    })
});

let menu_btn_list = document.querySelectorAll("#menu-btn");

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

// invite_btn?.addEventListener("click", () => {
//     document.querySelector("#popup-invite").style.display = "flex";
// });

let cambioColumnas = document.querySelector('#order-line');

cambioColumnas.addEventListener('click',()=>{
    let contenedor = document.querySelector('#content-grid')
    if (window.getComputedStyle(contenedor).display == 'grid') {
        contenedor.style.display = 'flex';
        contenedor.style.flexDirection = 'column'
    }
})

let cambioCuadros = document.querySelector('#order-chart')
cambioCuadros.addEventListener('click',()=>{
    let contenedor = document.querySelector('#content-grid')
    if (window.getComputedStyle(contenedor).display == 'flex') {
        contenedor.style.display = 'grid';
        contenedor.style.flexDirection = 'none'
    }
})

const LogOut = document.querySelector("#SignIn");
LogOut.addEventListener('click',()=>{
   console.log('Funciona');
   location.href = 'SignIn';
});

const userDropdown = document.getElementById('userDropdown');
const submenu = document.getElementById('submenu');

submenu.classList.add('hidden');
userDropdown.addEventListener('click', () => {
  if (submenu.classList.contains('hidden')) {
    submenu.classList.remove('hidden'); 
  } else {
    submenu.classList.add('hidden'); 
  }
});
