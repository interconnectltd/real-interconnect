$(function(){
/*===============================================
js
===============================================*/
/*===============================================
variable
===============================================*/
var windowWidth = $(window).width();
var windowHeight = $(window).height();
var windowSm = 560;
var headerHeight = $('header').outerHeight();
var topBtn = $('#page_top');topBtn.hide();


/*===============================================
function
===============================================*/

function sp_menu_toggle(){
  $('.menu_trigger').toggleClass('active');
  $('body').toggleClass('fixed');
  $('.sp_menu_block .sp_menu_list').toggleClass('is_show');
  $('.sp_menu_block .sp_menu_btn').toggleClass('is_show');
  $('.sp_menu').toggleClass('is_show');
  $('.sp_menu').height(windowHeight);
  $('.sp_menu .sp_menu_bg_img').toggleClass('is_show');
  $('.sp_menu .sp_menu_bg').toggleClass('is_show');
}

function scroll_top(){
  if($(window).scrollTop()>200){
    topBtn.fadeIn();
  }else{
    topBtn.fadeOut();
  }
}

function sp_hov_none(){
  var touch = 'ontouchstart' in document.documentElement
            || navigator.maxTouchPoints > 0
            || navigator.msMaxTouchPoints > 0;
 
  if (touch) {
      try {
          for (var si in document.styleSheets) {
              var styleSheet = document.styleSheets[si];
              if (!styleSheet.rules) continue;
   
              for (var ri = styleSheet.rules.length - 1; ri >= 0; ri--) {
                  if (!styleSheet.rules[ri].selectorText) continue;
   
                  if (styleSheet.rules[ri].selectorText.match(':hover')) {
                      styleSheet.deleteRule(ri);
                  }
              }
          }
      } catch (ex) {}
  }
}
if (windowWidth <= windowSm){
  sp_hov_none();
}

/*===============================================
fire
===============================================*/
// $('.scroll').on('click', function(event){
//   event.preventDefault();
//   var $this = $(this);
//   var linkTo = $this.attr('href');
//   var $target;
//   var offset = headerHeight;
//   var pos = 0;
//   if(linkTo != '#wrap'){
//     $target = $(linkTo);
//     pos = $target.offset().top - offset;
//   }
//   $('html,body').animate({scrollTop: pos}, 600);
// });


// ハンバーガー
$('.menu_trigger,.hamburger_btn,.sp_menu_wrap li .scroll').on('click', function() {
  sp_menu_toggle();
  return false;
});


// inview
$('.fade,.inview').on('inview', function(event, isInView){
  if (isInView) {
      $(this).addClass('is_inview');
  }
});


// topに戻る
$(window).on('scroll', function(){
    scroll_top();
});
$(topBtn).on('click', function(){
    $('body,html').animate({scrollTop: 0},700);
    return false;
});


// 文字省略
$(function(){
    var $setElm01 = $('.txt_ovf_01');
    var cutFigure01 = '33';
    var $setElm02 = $('.txt_ovf_02');
    var cutFigure02 = '48';
    var afterTxt = ' …';
 
    $setElm01.each(function(){
        var textLength = $(this).text().length;
        var textTrim = $(this).text().substr(0,(cutFigure01))
 
        if(cutFigure01 < textLength) {
            $(this).html(textTrim + afterTxt).css({visibility:'visible'});
        } else if(cutFigure01 >= textLength) {
            $(this).css({visibility:'visible'});
        }
    });
 
    $setElm02.each(function(){
        var textLength = $(this).text().length;
        var textTrim = $(this).text().substr(0,(cutFigure02))
 
        if(cutFigure02 < textLength) {
            $(this).html(textTrim + afterTxt).css({visibility:'visible'});
        } else if(cutFigure02 >= textLength) {
            $(this).css({visibility:'visible'});
        }
    });

});

/*===============================================
//js
===============================================*/
});