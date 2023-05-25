## What do we need?

### CSRF

The login process follows these steps:

1) visit `/login`
2) redirect to the SSO
3) if already logged in the SSO, redirect back to the app callback in `/cb`
4) set the session cookie, then redirect to `/`
5) set the CSRF cookie and render the home page

As you can see, the CSRF cookie is set **after** the session cookie.
If we are able to stop the browser from following the last redirect, the session cookie will be valid and the CSRF cookie will never be set.

The CSRF token is checked with the following code
```js
const csrfsecret = atob(req.cookies.csrf)
res.locals.csrftoken = csrf.create(csrfsecret)

if (req.method === 'POST'){
    if (!csrf.verify(csrfsecret, req.body.csrf) ){
        return res.send('Bad csrf')
    }
}
```

Note that, until node 16.17, if the CSRF cookie is not set, the value of `csrfsecret` is predictable.
```
atob(undefined) === 'ºw^~)Þ'
```

If we know `csrfsecret` we can forge a valid CSRF token using the library. For example, a valid token would be `UxL2WzWM-73GOa_pQWnuQ3dLiH6Rvw-8FWdw`. 

### Too many redirects

To exploit the CSRF we need to make the last redirect fail.
This is possible by exploiting the "Too many redirects" error thrown by the browser after a long redirect chain.
This error is useful to avoid redirect loops, but with some tuning, we can exploit it for our scope.

I wrote a simple server that creates an arbitrarily long chain of redirects before redirecting to an arbitrary URL. This is the code.
```js
app.get('/redirect', (req,res)=> {
    console.log(req.query)
    const n = parseInt( req.query.n )
    console.log(n)

    if (n == 0){
        return res.redirect(req.query.url)
    }

    res.redirect('/redirect?n=' + (n-1) + '&url=' + encodeURIComponent(req.query.url))
})
```

Then, with some tests, I find out that the right value of `n` to make the last redirect fail is `16`.
So, if I visit `http://exploitserver/redirect?n=16&url=http://print.localtest.me:3000/login` in the chromium browser, it will trigger the "Too many redirects" error and I will only have the session cookie set for the challenge domain.


### LFI

For the other bug, we need to bypass the checks on the files that we are trying to include.

This is done by a strict regex that doesn't allow path traversal.
However, this check can be bypassed because the regex sets the "global" attribute.

```js
const regex_bad_filename = /\.\.|\//g

for (let i=0; i<templates.length; i++){            
    const template = templates[i]
    if (regex_bad_filename.test(template) || !fs.existsSync(__dirname + '/public/templates/' + template)){
        res.locals.errormsg = 'Template not found'
    } else {
        const temp_text = fs.readFileSync(__dirname + '/public/templates/' + template, 'utf8')
        await set_template(res.locals.loggedUser, i, temp_text)
    }
}
```

Here's a simplified example to understand how this kind of regex behaves if used multiple times.

```js
> regex_bad_filename = /\.\.|\//g 
/\.\.|\//g
> regex_bad_filename.test('aaaa..aaaa')
true
> regex_bad_filename.lastIndex
6
> regex_bad_filename.test('aaaaaaaa..')
true
> regex_bad_filename.lastIndex
10
> regex_bad_filename.test('..aaaaaaaaa')
false
> regex_bad_filename.lastIndex
0
```

For more information about this behaviour check out [this article](https://dev.to/myogeshchavan97/javascript-regular-expressions-and-their-weird-behavior-1naj).

Exploiting this problem we can bypass the check.
For example, if we want to include the `/proc/self/environ` file (containing the flag) we need to import two files, like this.
```
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..
../../../../../../../proc/self/environ
```

### XSleak

Now we are able to import the environ file with the flag in the admin account using the CSRF.

However, we still need a way to read the file...

For this reason, we can use an XSleak combined with the custom substitution functionality offered by the application.

In practice, we can force (with a CSRF attack) the admin to print the template that contains the flag.
We know that the flag starts with `ptm{`, so we can try substituting in the template `ptm{a`, `ptm{b`, `ptm{c` and so on...

Then, we can tell if the part of the flag that we guessed was present in the template by checking if the printed version of the template was generated.

We can tell apart if the printed template was generated using [this](https://xsleaks.dev/docs/attacks/navigations/#download-navigation-without-iframes) XSleak that allows us to check if a specific path causes the download of a file.


For example, if we try to print the template with id `1` (containing the flag) substituting the string `ptm{a` with some random strings, we can check if the flag starts with `ptm{a` by checking if the endpoint `/printed/1/1` returns a 404 error or it downloads the printed file.  


## Let's put it all together

We need the following steps:
- Use the "Too many redirects" trick to make the bot log into the application without the CSRF cookie
- Use the CSRF with the LFI to import in the admin files the `/proc/self/environ` file (multiple times, so we can speed up the attack)
- Use the CSRF to print the templates with the flag brute forcing a character of the flag
- Use the XSleak to find the correct character of the flag

We can repeat this process for each character in the flag.

You can find my implementation of the exploit servers in the `exploitserver` folder.

You may need to tune some of the timings of the attack depending on the system where you are running the chromium bot.