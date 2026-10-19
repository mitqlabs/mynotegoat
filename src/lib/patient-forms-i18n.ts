/**
 * Words on the patient questionnaire page. English + Spanish; add a language
 * by adding a column. Question / option wording comes from the form (with an
 * optional Spanish version per question in Settings → Forms).
 */
export type FormLang = "en" | "es";

export const FORM_STRINGS = {
  en: {
    loading: "Loading your form…",
    start: "Start",
    next: "Next",
    back: "Back",
    review: "Review",
    submit: "Send to the office",
    submitting: "Sending…",
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    saved: "Saved",
    saving: "Saving…",
    notSaved: "Not saved yet — check your connection. We'll keep trying.",
    other: "Something else? Type it here",
    explain: "Yes — please explain",
    typeAnswer: "Type your answer",
    pickAll: "Choose all that apply.",
    pickOne: "Choose one.",
    optional: "You can skip any question you're not sure about.",
    reviewTitle: "Check your answers",
    reviewHint: "Tap Back to change anything. When it looks right, send it.",
    noAnswer: "Skipped",
    thanksTitle: "Thank you!",
    thanksBody: "Your answers were sent to the office. You can close this page.",
    inactiveTitle: "This link isn't active",
    errorTitle: "Something went wrong",
    tryAgain: "Try again",
    privacy: "Your answers go only to your doctor's office.",
    language: "Español",
  },
  es: {
    loading: "Cargando su formulario…",
    start: "Comenzar",
    next: "Siguiente",
    back: "Atrás",
    review: "Revisar",
    submit: "Enviar a la oficina",
    submitting: "Enviando…",
    step: (n: number, total: number) => `Paso ${n} de ${total}`,
    saved: "Guardado",
    saving: "Guardando…",
    notSaved: "Aún no se guardó — revise su conexión. Seguiremos intentando.",
    other: "¿Algo más? Escríbalo aquí",
    explain: "Sí — por favor explique",
    typeAnswer: "Escriba su respuesta",
    pickAll: "Elija todas las que apliquen.",
    pickOne: "Elija una.",
    optional: "Puede saltar cualquier pregunta si no está seguro.",
    reviewTitle: "Revise sus respuestas",
    reviewHint: "Toque Atrás para cambiar algo. Cuando esté bien, envíelo.",
    noAnswer: "Sin respuesta",
    thanksTitle: "¡Gracias!",
    thanksBody: "Sus respuestas se enviaron a la oficina. Puede cerrar esta página.",
    inactiveTitle: "Este enlace no está activo",
    errorTitle: "Algo salió mal",
    tryAgain: "Intentar de nuevo",
    privacy: "Sus respuestas van solo a la oficina de su doctor.",
    language: "English",
  },
} as const;

export type FormStrings = (typeof FORM_STRINGS)[FormLang];
