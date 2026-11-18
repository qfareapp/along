# Plan audience preferences

The second step of every category's plan form includes minimum/maximum age, Male/Female/Both, and a distance radius in kilometres or miles. Defaults are ages 18–120, Both (no gender restriction), and Any distance. These choices belong to the plan and do not change dating preferences.

A finite radius requires an approximate location. The form can reuse the member's saved approximate location or obtain a new location for this plan. The API rounds coordinates to three decimal places and stores the plan origin privately. Moving the owner's profile location later does not move an existing plan. Public plan responses include the audience summary but exclude coordinates.

The API applies these preferences to category counts, browse results, details, profile plans, direct interest requests, and acceptance. Existing visibility, privacy, blocking and eligibility rules continue to apply. Age boundaries are inclusive and computed from the viewer's saved birth date. Male maps to Man and Female maps to Woman; Both allows all gender identities. A viewer without an approximate location cannot access plans with a finite radius. Owners can manage their own plans regardless of their audience.

Plans created before this feature remain available under the existing visibility rules. Private Social invitations continue to use their participant permissions.

Social Discover evaluates public plans using their own audience rather than the organiser's or viewer's dating age/gender preferences. A Both plan can therefore reach eligible men and women without a prior match. Distance is measured from the saved plan origin to the viewer's approximate location, not from the organiser's current profile location. Any distance imposes no location requirement. The same plan visibility applies to browse, details and joining so a displayed card remains usable. Blocks, account eligibility, category availability, Social visibility, hiding, muting and plan moderation still apply. Matches mode remains limited to existing connections, and status updates retain their existing dating-preference rules.

Regression coverage: `apps/api/src/plan-audience.test.ts` and `apps/api/src/social.test.ts`, including mismatched dating preferences, Both audiences, plan-origin distance, opening/joining/accepting, and privacy exclusions. Browser coverage: `npm run qa:plans -- --posting-only`, including all 12 categories, invalid age ranges, saved radius, retained drafts, and the public details summary.
