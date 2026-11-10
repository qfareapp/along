# Validation boundaries

Authoritative input validation currently lives in `apps/api/src/validation.ts`. Mobile forms validate for feedback; the API validates independently. Never share private Mongoose documents as public transport contracts. Extract schemas into this package when expanding the remaining modules; do not add a second conflicting source of validation rules.
