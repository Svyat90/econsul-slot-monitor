// slots.html openBookingPage(): the prepared draft when the link is a valid one, otherwise a new
// "Запис на візит" application. The site's own route for a new application:
// /tasks/create/{workflowTemplateId}/{taskTemplateId}; it takes no prefill parameters.
export const BOOKING_URL = 'https://e-consul.gov.ua/tasks/create/161374/161374001';

// An existing application: /tasks/{taskId} or /tasks/{taskId}/{stepId}
export const DRAFT_URL_RE = /^https:\/\/e-consul\.gov\.ua\/tasks\/(?!create\/|my-tasks)[^/?#]+(\/[^?#]*)?$/;

export function bookingUrl(draftUrl: string | null): string {
    const url = draftUrl?.trim() ?? '';
    return DRAFT_URL_RE.test(url) ? url : BOOKING_URL;
}
