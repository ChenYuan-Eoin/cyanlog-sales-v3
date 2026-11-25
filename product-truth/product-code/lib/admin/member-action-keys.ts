export const ORG_MEMBER_INVITE = 'user:invite'
export const ORG_MEMBER_MANAGE_LOGIN = 'user:manage_login'
export const ORG_MEMBER_MANAGE_EMPLOYMENT = 'user:manage_employment'
export const ORG_MEMBER_REMOVE_MEMBERSHIP = 'user:remove_membership'

export const ORG_MEMBER_LIFECYCLE_ACTIONS = [
  ORG_MEMBER_INVITE,
  ORG_MEMBER_MANAGE_LOGIN,
  ORG_MEMBER_MANAGE_EMPLOYMENT,
  ORG_MEMBER_REMOVE_MEMBERSHIP,
] as const
