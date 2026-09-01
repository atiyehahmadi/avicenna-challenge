import { useId, useRef, useState, type FormEvent } from 'react';
import { useOutboxActions } from '../state/OutboxContext';
import styles from './ComposeForm.module.scss';

/**
 * Compose form. Hand-rolled rather than using a form library, which the brief
 * rules out — three controlled fields and a submit handler do not need one.
 *
 * Validation runs on submit rather than on every keystroke, so the user is not
 * told they are wrong while still typing the first character. Once a field has
 * been marked invalid it revalidates as they type, so the error clears the
 * moment it is fixed.
 *
 * This component consumes only the actions context, so it does not re-render
 * when messages change status during a dispatch — which matters, because
 * re-rendering it while someone is typing is exactly how you lose input.
 */

type Field = 'recipient' | 'subject' | 'body';
type Errors = Partial<Record<Field, string>>;

const EMPTY = { recipient: '', subject: '', body: '' };

function validate(values: Record<Field, string>): Errors {
  const errors: Errors = {};
  if (!values.recipient.trim()) errors.recipient = 'Recipient is required.';
  if (!values.subject.trim()) errors.subject = 'Subject is required.';
  if (!values.body.trim()) errors.body = 'Message body is required.';
  return errors;
}

export function ComposeForm() {
  const { addMessage } = useOutboxActions();
  const [values, setValues] = useState<Record<Field, string>>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const recipientRef = useRef<HTMLInputElement>(null);

  // useId keeps label/input/error wiring unique even if this form is ever
  // rendered more than once.
  const uid = useId();
  const fieldId = (field: Field) => `${uid}-${field}`;
  const errorId = (field: Field) => `${uid}-${field}-error`;

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    // Only revalidate after a failed submit, so errors never appear mid-typing
    // on a field the user has not finished with.
    if (submitted) setErrors(validate(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first invalid field rather than leaving the user to
      // hunt for the error.
      const firstInvalid = (['recipient', 'subject', 'body'] as const).find(
        (f) => found[f],
      );
      if (firstInvalid) document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }

    addMessage({
      recipient: values.recipient.trim(),
      subject: values.subject.trim(),
      body: values.body.trim(),
    });

    setValues(EMPTY);
    setErrors({});
    setSubmitted(false);
    // Return focus to the top of the form so a second message can be typed
    // without reaching for the mouse.
    recipientRef.current?.focus();
  }

  const describedBy = (field: Field) =>
    errors[field] ? errorId(field) : undefined;

  return (
    // noValidate: we own the messaging, so the browser's own bubbles would
    // duplicate it inconsistently across engines.
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.heading}>Compose</h2>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('recipient')}>
          Recipient
        </label>
        <input
          id={fieldId('recipient')}
          ref={recipientRef}
          className={styles.input}
          type="text"
          value={values.recipient}
          onChange={(e) => update('recipient', e.target.value)}
          aria-invalid={errors.recipient ? true : undefined}
          aria-describedby={describedBy('recipient')}
          autoComplete="off"
        />
        {errors.recipient && (
          <p className={styles.error} id={errorId('recipient')} role="alert">
            {errors.recipient}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('subject')}>
          Subject
        </label>
        <input
          id={fieldId('subject')}
          className={styles.input}
          type="text"
          value={values.subject}
          onChange={(e) => update('subject', e.target.value)}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={describedBy('subject')}
          autoComplete="off"
        />
        {errors.subject && (
          <p className={styles.error} id={errorId('subject')} role="alert">
            {errors.subject}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('body')}>
          Message
        </label>
        <textarea
          id={fieldId('body')}
          className={styles.textarea}
          rows={4}
          value={values.body}
          onChange={(e) => update('body', e.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={describedBy('body')}
        />
        {errors.body && (
          <p className={styles.error} id={errorId('body')} role="alert">
            {errors.body}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.submit} type="submit">
          Add to outbox
        </button>
      </div>
    </form>
  );
}
