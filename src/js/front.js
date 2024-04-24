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

// invite_btn?.addEventListener("click", () => {
//     document.querySelector("#popup-invite").style.display = "flex";
// });