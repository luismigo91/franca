---
name: gotcha-input-email-recorta-el-valor
description: type=email, url, number y date aplican el value sanitization de HTML y bloquean valores, así que el chat usa type=text con inputMode
metadata:
  type: project
  enforcement: apps/web/src/components/chat/pending-question.test.tsx, apps/web/e2e/questions.e2e.ts
---

# El navegador limpia o bloquea el valor de ciertos `<input>`

`<input type="email">` y `type="url"` aplican el *value sanitization algorithm* de HTML: quitan los saltos de línea y los blancos de los extremos, así que ` a@b.co ` llegaría recortado. `type="number"` y `type="date"` impiden escribir `muchos` o `16/10/2026`. Lo que prueba el chat es la **validación del flujo**: tiene que poder enviar `1.500`, ` hola ` o texto roto y ver el `reason`.

Por eso las siete preguntas de texto usan `<input type="text">` con `inputMode` (`email`, `tel`, `decimal`, `url`, `text`) y `autoComplete="off"`, sin `maxLength`, `required` ni `pattern`, y sin recortar nada. El texto exacto viaja en `{input: {text}}`. El test de marcado prohíbe esos `type` y el E2E «Las siete preguntas de texto» comprueba el cuerpo exacto, también los espacios.
