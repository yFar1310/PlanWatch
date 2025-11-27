<template>
    <!-- Full-screen animated background behind the whole app -->
    <canvas
      ref="canvasRef"
      class="fixed inset-0 -z-10 pointer-events-none"
    ></canvas>
  </template>
  
  <script setup lang="ts">
  import { onMounted, onBeforeUnmount, ref } from 'vue'
  
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  
  type Point = { x: number; y: number; vx: number; vy: number; r: number }
  let ctx: CanvasRenderingContext2D | null = null
  let w = 0
  let h = 0
  let points: Point[] = []
  let frameId: number | null = null
  const mouse = { x: 0, y: 0 }
  
  function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  }
  
  function initScene() {
    const canvas = canvasRef.value
    if (!canvas) return
  
    w = canvas.width = window.innerWidth
    h = canvas.height = window.innerHeight
  
    if (!ctx) ctx = canvas.getContext('2d')
    if (!ctx) return
  
    const count = Math.max(60, Math.round((w * h) / 8000))
    points = []
    for (let i = 0; i < count; i++) {
      points.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 40,
        vy: (Math.random() - 0.5) * 40,
        r: 1 + Math.random(),
      })
    }
  }
  
  function draw() {
    if (!ctx) return
  
    // fond sombre
    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, w, h)
  
    // points
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#e5e7eb'
    for (const p of points) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
  
    // lignes façon CodePen
    ctx.beginPath()
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
  
      // vers la souris
      if (dist(a, mouse) < 150) {
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(mouse.x, mouse.y)
      }
  
      // entre points proches
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j]
        if (dist(a, b) < 120) {
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
      }
    }
    ctx.lineWidth = 0.4
    ctx.strokeStyle = 'rgba(148,163,184,0.55)'
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }
  
  function update() {
    const fps = 60
    for (const p of points) {
      p.x += p.vx / fps
      p.y += p.vy / fps
      if (p.x < 0 || p.x > w) p.vx *= -1
      if (p.y < 0 || p.y > h) p.vy *= -1
    }
  }
  
  function loop() {
    draw()
    update()
    frameId = requestAnimationFrame(loop)
  }
  
  function handleResize() {
    initScene()
  }
  
  function handleMouseMove(e: MouseEvent) {
    mouse.x = e.clientX
    mouse.y = e.clientY
  }
  
  onMounted(() => {
    initScene()
    loop()
    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', handleMouseMove)
  })
  
  onBeforeUnmount(() => {
    if (frameId != null) cancelAnimationFrame(frameId)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('mousemove', handleMouseMove)
  })
  </script>
  