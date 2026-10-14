export function profileRoot():string;
export function profileConnection(root?:string):{version:string;binary:string;url:string;password:string;pid:number;fullAccess:boolean;root:string;headers:Record<string,string>};
export function cleanWorkerEnv(source:NodeJS.ProcessEnv,root:string):Record<string,string>;
export function shellWorkerEnv(source:NodeJS.ProcessEnv,root:string):Record<string,string>;
export function workerConfig():Record<string,unknown>;
export function prepareProfile(binary:string,root?:string):Record<string,unknown>;
