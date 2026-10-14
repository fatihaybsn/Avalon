export const MANAGER_PERMISSIONS:Array<{action:string;resource:string;effect:'deny'|'allow'}>;
export const MANAGER_AGENT:{description:string;mode:'primary';permissions:typeof MANAGER_PERMISSIONS};
export function assertManagerSession(session:unknown,expectedId:string):void;
