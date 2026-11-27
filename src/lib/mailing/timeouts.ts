/** Délai TOTAL d'un sendMail : au-delà, delivery_unknown, jamais de renvoi (au plus une fois). */
export const SEND_TIMEOUT_MS = 60_000;

/** Marge laissée à l'étape de tick mailing au-delà d'un envoi, pour qu'un SMTP lent ne déclenche pas l'avertissement. */
const MAILING_STEP_MARGIN_MS = 10_000;

/** Délai de l'étape mailing du tick : strictement supérieur à un envoi. */
export const MAILING_STEP_TIMEOUT_MS = SEND_TIMEOUT_MS + MAILING_STEP_MARGIN_MS;
