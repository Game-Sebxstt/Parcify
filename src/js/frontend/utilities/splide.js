import Splide from '@splidejs/splide'

const options = {
  type: 'loop',
  fixedWidth: '100%',
  height: '100%',
  focus: 'center',
  keyboard: 'global',
  perPage: 1,
  wheel: false,
  autoplay: true,
  pauseOnHover: true,
  arrows: false,
  pagination: true,
}

if(document.querySelector("#splide")){
  const splide = new Splide('#splide', options);
  var bar = splide.root.querySelector('.my-carousel-progress-bar');

  splide.on('mounted move', function () {
    var end  = splide.Components.Controller.getEnd() + 1;
    var rate = Math.min( ( splide.index + 1 ) / end, 1 );
    bar.style.width = String( 100 * rate ) + '%';
  });

  splide.mount();
}