const filter_index = document.querySelector('#filter-index');

filter_index?.addEventListener("click", () => {
    const more_options_filter = document.querySelector('#more-options-filter');
    const arrow_down_filter = document.querySelector('#arrow-down-filter');
    if(window.getComputedStyle(more_options_filter).display === 'none'){
        more_options_filter.style.display = 'flex';
        arrow_down_filter.style.transform = 'rotate(180deg)';
    }else{
        more_options_filter.style.display = 'none';
        arrow_down_filter.style.transform = 'rotate(0deg)';
    }
})

const items_slide = document.querySelectorAll("#items-slide");

items_slide.forEach((element) => {
    element.addEventListener("click", () => {
        window.location.href = element.getAttribute("data-uri");
    });
})

const menu_header = document.querySelector("#menu-header");

menu_header?.addEventListener("click", () => {
    const slide = document.querySelector("#slide");
    console.log(window.getComputedStyle(slide).left)
    if(window.getComputedStyle(slide).left == "0px"){
        slide.style.left = "-100%"
    }else{
        slide.style.left = "0%"
    }
});