<template>
  <!-- 全局 SVG 滤镜：铅笔抖动（#tp-rough）与印泥斑驳（#tp-stamp）。全应用挂载一次。 -->
  <svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
    <defs>
      <filter id="tp-rough" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="tp-stamp" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.6" result="holes" />
        <feComposite in="SourceGraphic" in2="holes" operator="in" result="worn" />
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="1" seed="11" result="wobble" />
        <feDisplacementMap in="worn" in2="wobble" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  </svg>
</template>
